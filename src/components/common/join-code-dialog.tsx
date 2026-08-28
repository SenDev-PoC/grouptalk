import { Check, Copy, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { toast } from 'sonner'

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
      toast.success('입장 링크를 복사했습니다.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('복사하지 못했습니다. 주소를 직접 알려 주세요.')
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
          <DialogTitle>모둠 기기에서 스캔</DialogTitle>
          <DialogDescription>
            모둠당 기기 한 대로 스캔하면 입장 화면이 열립니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 pt-1">
          <div className="rounded-xl border bg-white p-4">
            <QRCodeSVG value={joinUrl} size={208} level="M" marginSize={0} />
          </div>

          <div className="space-y-1.5 text-center">
            <p className="text-muted-foreground text-xs">입장 코드</p>
            <p className="tabular text-3xl font-semibold tracking-[0.25em]">{joinCode}</p>
          </div>

          <div className="w-full space-y-2">
            <p className="text-muted-foreground bg-muted/60 truncate rounded-md px-3 py-2 text-center text-xs">
              {joinUrl}
            </p>
            <Button variant="outline" className="w-full" onClick={copyLink}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              입장 링크 복사
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
