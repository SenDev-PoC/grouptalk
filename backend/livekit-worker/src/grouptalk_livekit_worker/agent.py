import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from functools import partial
from uuid import UUID

import httpx
from livekit import agents, rtc
from livekit.agents import stt
from livekit.plugins import deepgram

from grouptalk_livekit_worker.api_client import UtteranceAPIClient
from grouptalk_livekit_worker.config import WorkerSettings
from grouptalk_livekit_worker.logging_utils import install_pii_log_filter
from grouptalk_livekit_worker.pipeline import GroupPipeline, PipelineOutcome
from grouptalk_livekit_worker.transcripts import TranscriptEvent

logger = logging.getLogger(__name__)


class LiveKitAudioSource:
    def __init__(self, stream: rtc.AudioStream) -> None:
        self._stream = stream

    def __aiter__(self) -> AsyncIterator[rtc.AudioFrame]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[rtc.AudioFrame]:
        async for event in self._stream:
            yield event.frame

    async def aclose(self) -> None:
        await self._stream.aclose()


class DeepgramSpeechStream:
    def __init__(self, stream: stt.RecognizeStream) -> None:
        self._stream = stream

    @property
    def start_time(self) -> float:
        return self._stream.start_time

    @property
    def start_time_offset(self) -> float:
        return self._stream.start_time_offset

    async def push_frame(self, frame: object) -> None:
        if not isinstance(frame, rtc.AudioFrame):
            raise TypeError("Deepgram stream requires an AudioFrame")
        self._stream.push_frame(frame)

    async def end_input(self) -> None:
        self._stream.end_input()

    async def aclose(self) -> None:
        await self._stream.aclose()

    def __aiter__(self) -> AsyncIterator[TranscriptEvent]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[TranscriptEvent]:
        async for event in self._stream:
            if event.type not in {
                stt.SpeechEventType.INTERIM_TRANSCRIPT,
                stt.SpeechEventType.FINAL_TRANSCRIPT,
            }:
                continue
            if not event.alternatives:
                continue
            alternative = event.alternatives[0]
            if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                logger.info(
                    "deepgram_final_received",
                    extra={
                        "event_code": "deepgram_final_received",
                        "has_text": bool(alternative.text.strip()),
                        "has_speaker": alternative.speaker_id is not None,
                    },
                )
            yield TranscriptEvent(
                final=event.type == stt.SpeechEventType.FINAL_TRANSCRIPT,
                text=alternative.text,
                speaker_id=alternative.speaker_id,
                start_time=alternative.start_time,
            )


PipelineFactory = Callable[[rtc.Track, UUID, UUID], GroupPipeline]


@dataclass(slots=True)
class PipelineHandle:
    track_sid: str
    pipeline: GroupPipeline
    task: asyncio.Task[PipelineOutcome]


class RoomPipelineRegistry:
    def __init__(self, pipeline_factory: PipelineFactory) -> None:
        self._pipeline_factory = pipeline_factory
        self._handles: dict[UUID, PipelineHandle] = {}
        self._group_locks: dict[UUID, asyncio.Lock] = {}
        self._registry_lock = asyncio.Lock()
        self._closing = False

    async def start(self, track: rtc.Track, session_id: UUID, group_id: UUID) -> None:
        group_lock = self._group_locks.setdefault(group_id, asyncio.Lock())
        async with group_lock:
            if self._closing:
                return
            previous = self._handles.get(group_id)
            if previous is not None and previous.track_sid == track.sid:
                return
            if previous is not None:
                if not previous.task.done():
                    await previous.pipeline.close()
                await asyncio.gather(previous.task, return_exceptions=True)

            pipeline = self._pipeline_factory(track, session_id, group_id)
            task = asyncio.create_task(pipeline.run(), name="group-transcript-pipeline")
            handle = PipelineHandle(track_sid=track.sid, pipeline=pipeline, task=task)
            async with self._registry_lock:
                if self._closing:
                    await pipeline.close()
                    await asyncio.gather(task, return_exceptions=True)
                    return
                self._handles[group_id] = handle
            task.add_done_callback(
                lambda completed, group_id=group_id, handle=handle: asyncio.create_task(
                    self._discard_completed(group_id, handle, completed)
                )
            )

    async def stop_track(self, track_sid: str) -> None:
        match: tuple[UUID, PipelineHandle] | None = None
        async with self._registry_lock:
            for group_id, handle in self._handles.items():
                if handle.track_sid == track_sid:
                    match = (group_id, handle)
                    self._handles.pop(group_id)
                    break
        if match is None:
            return
        _, handle = match
        if not handle.task.done():
            await handle.pipeline.close()
        await asyncio.gather(handle.task, return_exceptions=True)

    async def close_all(self) -> None:
        async with self._registry_lock:
            self._closing = True
            handles = list(self._handles.values())
            self._handles.clear()
        active_handles = [handle for handle in handles if not handle.task.done()]
        await asyncio.gather(
            *(handle.pipeline.close() for handle in active_handles), return_exceptions=True
        )
        await asyncio.gather(*(handle.task for handle in handles), return_exceptions=True)

    async def _discard_completed(
        self,
        group_id: UUID,
        handle: PipelineHandle,
        completed: asyncio.Task[PipelineOutcome],
    ) -> None:
        async with self._registry_lock:
            if self._handles.get(group_id) is handle:
                self._handles.pop(group_id)
        try:
            outcome = completed.result()
        except Exception:
            logger.error("pipeline_task_failed", extra={"event_code": "pipeline_task_failed"})
            return
        logger.info(
            "pipeline_finished",
            extra={"event_code": "pipeline_finished", "pipeline_state": outcome.code},
        )


def parse_session_id(room_name: str) -> UUID:
    prefix = "session_"
    if not room_name.startswith(prefix):
        raise ValueError("room name must use the session_<UUID> format")
    return UUID(room_name[len(prefix) :])


def eligible_microphone_track(
    track: rtc.Track,
    publication: rtc.RemoteTrackPublication,
    participant: rtc.RemoteParticipant,
) -> UUID | None:
    if track.kind != rtc.TrackKind.KIND_AUDIO:
        return None
    if publication.source != rtc.TrackSource.SOURCE_MICROPHONE:
        return None
    try:
        return UUID(participant.identity)
    except (TypeError, ValueError):
        return None


def create_group_pipeline_factory(
    settings: WorkerSettings,
    api_client: UtteranceAPIClient,
) -> PipelineFactory:
    def create_pipeline(track: rtc.Track, session_id: UUID, group_id: UUID) -> GroupPipeline:
        logger.info(
            "deepgram_pipeline_created",
            extra={"event_code": "deepgram_pipeline_created"},
        )
        speech_to_text = deepgram.STT(
            model="nova-3",
            language="ko",
            interim_results=True,
            punctuate=True,
            smart_format=True,
            enable_diarization=True,
            endpointing_ms=300,
            mip_opt_out=True,
            api_key=settings.deepgram_api_key.get_secret_value(),
        )
        if not speech_to_text.capabilities.diarization:
            raise RuntimeError("Deepgram diarization capability is required")
        speech_stream = speech_to_text.stream(
            conn_options=agents.APIConnectOptions(max_retry=2, timeout=10.0)
        )
        return GroupPipeline(
            session_id=session_id,
            group_id=group_id,
            audio_source=LiveKitAudioSource(rtc.AudioStream(track)),
            speech_stream=DeepgramSpeechStream(speech_stream),
            api_client=api_client,
            queue_capacity=settings.transcript_queue_capacity,
            shutdown_timeout=settings.pipeline_shutdown_timeout_seconds,
        )

    return create_pipeline


async def run_room(
    ctx: agents.JobContext,
    settings: WorkerSettings,
    *,
    pipeline_factory: PipelineFactory | None = None,
) -> None:
    # CLI logging handlers exist by the time a room job starts.
    install_pii_log_filter()
    session_id = parse_session_id(ctx.job.room.name)
    stopped = asyncio.Event()
    event_tasks: set[asyncio.Task[object]] = set()

    async with httpx.AsyncClient(timeout=settings.api_request_timeout_seconds) as http_client:
        api_client = UtteranceAPIClient(
            base_url=settings.grouptalk_api_url,
            token=settings.worker_api_token.get_secret_value(),
            http_client=http_client,
            max_attempts=settings.api_max_attempts,
        )
        registry = RoomPipelineRegistry(
            pipeline_factory or create_group_pipeline_factory(settings, api_client)
        )

        def keep_task(task: asyncio.Task[object]) -> None:
            event_tasks.add(task)

            def consume_result(completed: asyncio.Task[object]) -> None:
                event_tasks.discard(completed)
                try:
                    completed.result()
                except asyncio.CancelledError:
                    return
                except Exception:
                    logger.error(
                        "room_event_task_failed",
                        extra={"event_code": "room_event_task_failed"},
                    )

            task.add_done_callback(consume_result)

        @ctx.room.on("track_subscribed")
        def on_track_subscribed(track, publication, participant) -> None:
            group_id = eligible_microphone_track(track, publication, participant)
            if group_id is not None:
                logger.info(
                    "microphone_track_subscribed",
                    extra={"event_code": "microphone_track_subscribed"},
                )
                keep_task(asyncio.create_task(registry.start(track, session_id, group_id)))

        @ctx.room.on("track_unsubscribed")
        def on_track_unsubscribed(track, publication, participant) -> None:
            keep_task(asyncio.create_task(registry.stop_track(track.sid)))

        @ctx.room.on("disconnected")
        def on_disconnected(reason) -> None:
            stopped.set()

        async def shutdown() -> None:
            stopped.set()
            await registry.close_all()

        ctx.add_shutdown_callback(shutdown)
        await ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)
        logger.info("room_connected", extra={"event_code": "room_connected"})
        await stopped.wait()
        await registry.close_all()
        if event_tasks:
            await asyncio.gather(*event_tasks, return_exceptions=True)


def create_server(settings: WorkerSettings | None = None) -> agents.AgentServer:
    resolved_settings = settings or WorkerSettings()
    server = agents.AgentServer(
        ws_url=resolved_settings.livekit_url,
        api_key=resolved_settings.livekit_api_key.get_secret_value(),
        api_secret=resolved_settings.livekit_api_secret.get_secret_value(),
        drain_timeout=30,
        shutdown_process_timeout=15.0,
        port=resolved_settings.port,
        permissions=agents.WorkerPermissions(
            can_subscribe=True,
            can_publish=False,
            can_publish_data=False,
            can_update_metadata=False,
            hidden=True,
        ),
    )

    server.rtc_session(
        partial(run_room, settings=resolved_settings),
        agent_name=resolved_settings.livekit_worker_agent_name,
        type=agents.WorkerType.ROOM,
    )
    return server


def main() -> None:
    install_pii_log_filter()
    agents.cli.run_app(create_server())


if __name__ == "__main__":
    main()
