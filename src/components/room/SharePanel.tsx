import { Check, Copy, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { APP_NAME, roomUrl } from '../../config';

export function SharePanel({ code, roomName }: { code: string; roomName: string }) {
  const url = roomUrl(code);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true); // e.g. plain http on a LAN address: the link stays selectable below
    }
  };

  const canShare = typeof navigator.share === 'function';
  const share = () => navigator.share({ title: `${roomName} · ${APP_NAME}`, text: `Listen with us in ${roomName}`, url }).catch(() => {});

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="bg-white p-4 shadow-soft">
        <QRCodeSVG value={url} size={176} level="M" fgColor="#2a2019" bgColor="#ffffff" title={`QR code to join ${roomName}`} />
      </div>
      <div>
        <div className="eyebrow text-ink-soft">Room code</div>
        <div className="mt-1 select-all font-display text-5xl font-semibold tracking-[0.18em] text-indigo">{code}</div>
      </div>
      <div className="flex w-full items-stretch border-[1.5px] border-ink bg-cream/80">
        <span className="min-w-0 flex-1 select-all truncate px-3 py-3 text-left text-sm">{url}</span>
        <button className="eyebrow flex flex-none items-center gap-2 border-l-[1.5px] border-ink px-4 hover:bg-white" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyFailed && <p className="-mt-3 text-xs text-ink-soft">Copying isn't allowed on this connection. Select the link above instead.</p>}
      {canShare && (
        <button className="btn btn-ghost w-full" onClick={share}>
          <Share2 size={16} /> Share link
        </button>
      )}
      <p className="text-sm text-ink-soft">Anyone with the link or code can join. No account needed.</p>
    </div>
  );
}
