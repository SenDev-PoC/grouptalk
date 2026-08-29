import { Check, Copy, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function JoinCodeDialog({ joinCode }: { joinCode: string }) {
  const [copied, setCopied] = useState(false)
  const joinUrl = `${window.location.origin}/join/${joinCode}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — URL은 화면에 표시되어 있다.
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4" />
          QR 보기
        </Button>
      </DialogTrigger>

      <DialogContent className="flex flex-col items-center sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <DialogTitle>모둠 입장 코드</DialogTitle>
          <DialogDescription>
            모둠 기기에서 스캔하면 입장 화면이 열립니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex w-full flex-col items-center gap-5 pt-1">
          <div className="rounded-xl border bg-white p-4">
            <QRCodeSVG value={joinUrl} size={208} level="M" marginSize={0} />
          </div>

          <div className="flex w-full items-center justify-center gap-1">
            <p className="text-muted-foreground min-w-0 truncate px-1 text-center text-xs">
              {joinUrl}
            </p>
            <Button variant="ghost" size="icon" className="size-10 shrink-0" onClick={copyLink}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="sr-only">{copied ? '복사됨' : '링크 복사'}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
