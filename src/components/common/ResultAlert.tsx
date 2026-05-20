import { Alert } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface ResultMessage {
  ok: boolean;
  msg: string;
}

interface Props {
  result: ResultMessage | null;
  warning?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function ResultAlert({ result, warning = false, className, children }: Props) {
  if (!result) return null;

  const color = warning ? "yellow" : result.ok ? "green" : "red";
  const Icon = warning ? IconInfoCircle : result.ok ? IconCheck : IconAlertCircle;

  return (
    <Alert className={className} color={color} icon={<Icon size={16} />} radius="md" variant="light">
      <div>{result.msg}</div>
      {children}
    </Alert>
  );
}
