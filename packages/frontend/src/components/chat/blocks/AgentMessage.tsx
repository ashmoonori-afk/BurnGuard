export default function AgentMessage({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
      {text}
    </div>
  );
}
