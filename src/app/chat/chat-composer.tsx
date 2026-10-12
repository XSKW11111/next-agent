import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import styles from "./chat-composer.module.css";

export function ChatComposer({
  input,
  canSend,
  onInput,
  onSubmit,
}: {
  input: string;
  canSend: boolean;
  onInput?: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <label className={styles.label}>
        Message
        <Input value={input} onChange={(event) => onInput?.(event.target.value)} />
      </label>
      <Button type="submit" disabled={!canSend}>
        Send
      </Button>
    </form>
  );
}
