import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import styles from "./chat-card.module.css";

export function ChatCard({ children }: { children: ReactNode }) {
  return <Card className={styles.card}>{children}</Card>;
}
