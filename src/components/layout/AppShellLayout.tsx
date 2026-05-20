import type { ReactNode } from "react";
import "./AppShellLayout.css";

interface Props {
  rail: ReactNode;
  devices: ReactNode;
  header: ReactNode;
  content: ReactNode;
  status: ReactNode;
}

export default function AppShellLayout({ rail, devices, header, content, status }: Props) {
  return (
    <div className="app-shell-layout">
      <div className="app-shell-layout__body">
        <aside className="app-shell-layout__rail">{rail}</aside>
        <aside className="app-shell-layout__devices">{devices}</aside>
        <main className="app-shell-layout__workspace">
          {header}
          <div className="app-shell-layout__content">{content}</div>
        </main>
      </div>
      {status}
    </div>
  );
}
