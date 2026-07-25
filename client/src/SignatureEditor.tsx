import { useEffect, useRef } from 'react';

/**
 * A small rich-text editor for an email sign-off. Stores HTML, and inserts any
 * uploaded image as an inline `data:` URI so the signature is self-contained
 * and survives being sent/pasted into a mail client. Users can also paste a
 * formatted signature straight from Outlook/Word.
 */
export function SignatureEditor({ value, onChange, disabled }: { value: string; onChange: (html: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync external value in without disturbing the caret while the user types.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && (value || '') !== el.innerHTML) el.innerHTML = value || '';
  }, [value]);

  const emit = () => onChange(ref.current?.innerHTML || '');
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const addLink = () => {
    const url = window.prompt('Link URL (include https://):', 'https://');
    if (url) exec('createLink', url);
  };
  const onImage = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      ref.current?.focus();
      document.execCommand('insertImage', false, String(r.result));
      emit();
    };
    r.readAsDataURL(file);
  };

  const btn = { className: 'btn secondary small', type: 'button' as const, disabled };

  return (
    <div>
      {!disabled && (
        <div className="row" style={{ gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          <button {...btn} style={{ fontWeight: 700 }} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>B</button>
          <button {...btn} style={{ fontStyle: 'italic' }} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>I</button>
          <button {...btn} style={{ textDecoration: 'underline' }} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>U</button>
          <button {...btn} onMouseDown={(e) => e.preventDefault()} onClick={addLink}>🔗 Link</button>
          <button {...btn} onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>🖼 Upload image</button>
          <button {...btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}>Clear formatting</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        style={{
          minHeight: 120,
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 12px',
          background: disabled ? 'var(--panel)' : '#fff',
          color: '#16233b',
          fontSize: 13,
          lineHeight: 1.5,
          overflowX: 'auto',
        }}
      />
      {!disabled && <div className="hint" style={{ marginTop: 4 }}>Type your sign-off, or paste it from Outlook/Word. Uploaded images are embedded in the email so recipients always see them.</div>}
    </div>
  );
}
