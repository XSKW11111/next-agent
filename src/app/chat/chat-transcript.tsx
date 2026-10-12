import type { ReactNode } from "react";
import styles from "./chat-transcript.module.css";

export function ChatTranscript({ children }: { children: ReactNode }) {
  return <div className={styles.transcript}>{children}</div>;
}
