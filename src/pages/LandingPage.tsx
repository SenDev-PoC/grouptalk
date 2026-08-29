import { LayoutGrid, QrCode, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/common/brand-mark'
import { Button } from '@/components/ui/button'

const features = [
  {
    icon: LayoutGrid,
    title: '모둠 편성',
    body: '학급 명단과 조건으로 조를 나누고, 수업 전에 모둠을 확정합니다.',
  },
  {
    icon: QrCode,
    title: '한 번에 입장',
    body: '활동 QR을 열면 모둠 공용 기기가 바로 수업에 들어옵니다.',
  },
  {
    icon: Radio,
    title: '지금 살펴볼 모둠',
    body: '발화 균형과 도움 요청을 보며, 먼저 다가갈 모둠을 고릅니다.',
  },
]

const steps = [
  '학급을 만들고 모둠을 편성합니다.',
  '활동을 연 뒤 QR로 모둠을 들입니다.',
  '참여 상태를 보며 필요한 모둠을 찾아갑니다.',
]

export default function LandingPage() {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="bg-primary text-primary-foreground sticky top-0 z-30 border-b border-white/10">
        <div className="mx-auto flex h-[4.5rem] w-full max-w-6xl items-center justify-between gap-4 px-6">
          <BrandMark inverted />
          <Button asChild variant="on-primary">
            <Link to="/signup">시작하기</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-6 py-14 sm:py-20">
        <section className="space-y-6">
          <p className="text-muted-foreground text-sm font-semibold">교실 모둠 활동 지원</p>
          <h1 className="text-4xl font-bold tracking-tight">
            여러 모둠의 대화를, 한눈에
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            모둠뷰는 여러 모둠이 동시에 이야기하는 수업에서, 교사가 지금 살펴볼 곳을 빠르게 찾도록 돕는 도구입니다.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/login">지금 바로 시작하기</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="bg-card rounded-xl border border-border/70 px-5 py-6"
            >
              <span className="bg-secondary text-secondary-foreground mb-4 flex size-10 items-center justify-center rounded-lg">
                <feature.icon className="size-5" />
              </span>
              <h2 className="mb-2 font-bold">{feature.title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">{feature.body}</p>
            </article>
          ))}
        </section>

        <section className="space-y-5">
          <h2 className="text-xl font-bold tracking-tight">수업은 이렇게 진행됩니다</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step} className="bg-sand-soft/70 rounded-xl px-5 py-5">
                <p className="text-muted-foreground mb-2 text-sm font-semibold">{index + 1}</p>
                <p className="font-semibold leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  )
}
