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

      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>모둠 입장 코드</DialogTitle>
          <DialogDescription>
            모둠 기기에서 스캔하면 입장 화면이 열립니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 pt-1">
          <div className="rounded-xl border bg-white p-4">
            <QRCodeSVG value={joinUrl} size={208} level="M" marginSize={0} />
          </div>

          <div className="w-fit space-y-2 flex items-center justify-center">
            <p className="text-muted-foreground truncate rounded-md px-3 py-2 text-center text-xs">
              {joinUrl}
            </p>
            <Button variant="ghost" className="w-fit ml-auto" onClick={copyLink}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
