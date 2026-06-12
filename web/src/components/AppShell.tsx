import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const SOON: string[] = [];

export function AppShell({ unprotected, children }: { unprotected: boolean; children: ReactNode }) {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">⛅ rclone GUI</div>
        <NavLink to="/" className={({ isActive }) => (isActive ? "active" : "")}>📁 Remotes</NavLink>
        <NavLink to="/browse" className={({ isActive }) => (isActive ? "active" : "")}>🗂 Browse</NavLink>
        <NavLink to="/jobs" className={({ isActive }) => (isActive ? "active" : "")}>⇄ Jobs</NavLink>
        <NavLink to="/serve" className={({ isActive }) => (isActive ? "active" : "")}>🔌 Serve</NavLink>
        <NavLink to="/mounts" className={({ isActive }) => (isActive ? "active" : "")}>💾 Mounts</NavLink>
        <NavLink to="/schedules" className={({ isActive }) => (isActive ? "active" : "")}>⏰ Schedules</NavLink>
        {SOON.map((s) => (
          <span key={s} className="navitem disabled">{s} · soon</span>
        ))}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>⚙ Settings</NavLink>
      </nav>
      <main className="content">
        {unprotected ? (
          <div className="banner" role="alert">⚠ Running unprotected — set GUI_PASSWORD to require login.</div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
