"use client";
/** Message composer: text, attachment tray (demo stills, uploads, demo voice note, demo contact card) and a record button. */
import { useRef, useState } from "react";
import { demoVoiceNote } from "./demo-audio";

export type Outgoing = { text?: string; files?: File[]; demo?: string[] };

/** A homeowner contact card as WhatsApp shares it (vCard 3.0 with a waid). Ofcom drama-range number. */
const DEMO_CONTACT = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Hart;Emily;;;",
  "FN:Emily Hart",
  "item1.TEL;waid=447700900104:+44 7700 900104",
  "END:VCARD",
].join("\r\n");

export function Composer(props: { stills: string[]; disabled: boolean; onSend: (o: Outgoing) => void }) {
  const [text, setText] = useState("");
  const [tray, setTray] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const send = (o: Outgoing) => {
    setTray(false);
    props.onSend(o);
  };

  async function toggleRecord() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const type = (rec.mimeType || "audio/webm").split(";")[0];
        send({ files: [new File(chunks, `voice.${type.split("/")[1]}`, { type })] });
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      // No mic (or permission denied): the demo voice note in the tray still works.
      setTray(true);
    }
  }

  return (
    <div className="relative bg-[#f0ede4] px-2 pb-3 pt-2">
      {tray && (
        <div className="absolute inset-x-2 bottom-full mb-2 rounded-3xl bg-white p-4 shadow-xl ring-1 ring-black/5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Thorburn demo stills</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {props.stills.map((s) => (
              <button key={s} type="button" onClick={() => send({ demo: [s] })} className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-black/5" title={s}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/demo/${s}`} alt={s} className="h-full w-full object-cover transition group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-[9px] font-medium capitalize text-white">
                  {s.replace(/\.[a-z]+$/, "").replace(/-/g, " ")}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] font-medium text-olive sm:grid-cols-4">
            <button type="button" onClick={() => photoInput.current?.click()} className="rounded-2xl bg-olive-50 px-2 py-2.5 hover:bg-olive-100">Upload photos</button>
            <button type="button" onClick={() => audioInput.current?.click()} className="rounded-2xl bg-olive-50 px-2 py-2.5 hover:bg-olive-100">Upload voice note</button>
            <button type="button" onClick={() => send({ files: [new File([demoVoiceNote()], "demo-voice-note.wav", { type: "audio/wav" })] })} className="rounded-2xl bg-olive-50 px-2 py-2.5 hover:bg-olive-100">
              Demo voice note
            </button>
            <button type="button" onClick={() => send({ files: [new File([DEMO_CONTACT], "Emily Hart.vcf", { type: "text/vcard" })] })} className="rounded-2xl bg-olive-50 px-2 py-2.5 hover:bg-olive-100">
              Homeowner contact
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">The demo voice note is a synthetic clip with no speech. The contact card is Emily Hart, a demo homeowner.</p>
        </div>
      )}
      <input ref={photoInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => e.target.files?.length && send({ files: [...e.target.files] })} />
      <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.length && send({ files: [...e.target.files] })} />

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send({ text });
          setText("");
        }}
      >
        <div className="flex min-h-11 flex-1 items-center gap-1 rounded-full bg-white pl-2 pr-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTray((t) => !t)}
            aria-label="Attach photo or voice note"
            aria-expanded={tray}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${tray ? "bg-olive-100 text-olive" : "text-black/45 hover:text-olive"}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-45" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 11.5l-8.5 8.5a5 5 0 01-7-7L14 4.5a3.5 3.5 0 015 5L10.5 18a2 2 0 01-3-3L15 7.5" strokeLinecap="round" />
            </svg>
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={recording ? "Recording… tap the mic to send" : "Message"}
            aria-label="Message"
            className="h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/35"
          />
        </div>
        {text.trim() ? (
          <button type="submit" disabled={props.disabled} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-full bg-olive text-white shadow-md transition hover:bg-olive-dark disabled:opacity-50">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d="M3.4 20.4l17.4-7.5a1 1 0 000-1.8L3.4 3.6a1 1 0 00-1.4 1.1L4 11l9 1-9 1-2 6.3a1 1 0 001.4 1.1z" /></svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleRecord}
            aria-label={recording ? "Stop and send voice note" : "Record a voice note"}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-white shadow-md transition ${recording ? "animate-pulse bg-red-600" : "bg-olive hover:bg-olive-dark"}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12h-2z" /></svg>
          </button>
        )}
      </form>
    </div>
  );
}
