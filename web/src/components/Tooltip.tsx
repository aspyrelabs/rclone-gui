export function Tooltip({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="tooltip" aria-label={text} role="img">
      {" ⓘ"}
      <span className="tip">{text}</span>
    </span>
  );
}
