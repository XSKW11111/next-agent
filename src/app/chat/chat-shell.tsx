import type { ReactNode } from "react";
import styles from "./chat-shell.module.css";

export function ChatShell({ children }: { children: ReactNode }) {
  return <main className={styles.shell}>{children}</main>;
}
