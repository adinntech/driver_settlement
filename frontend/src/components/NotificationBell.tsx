"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/services/api";
import type { AppNotification } from "@/types/domain";
import { formatDateTime } from "@/utils/format";

interface Payload {
  items: AppNotification[];
  unread: number;
}

/** Internal notifications for the signed-in user (polls every 30s). */
export default function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<Payload>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0); // unread count the user has already looked at: the bell rings only for newer ones
  const ringing = data.unread > seen && !open;
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    request<Payload>("/notifications")
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  async function openItem(n: AppNotification) {
    setOpen(false);
    if (!n.read) await request(`/notifications/${n._id}/read`, "POST").catch(() => {});
    load();
    router.push(n.link);
  }

  async function readAll() {
    await request("/notifications/read-all", "POST").catch(() => {});
    load();
  }

  return (
    <div className="bell" ref={box}>
      <button className={`bell-btn${ringing ? " is-ringing" : ""}${open ? " is-open" : ""}`} onClick={() => { setOpen(!open); setSeen(data.unread); if (!open) load(); }} aria-label={`Notifications, ${data.unread} unread`} aria-expanded={open}>
        <svg className="bell-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.6 6.4 2.4 7.2.3.3.1.8-.3.8H3.9c-.4 0-.6-.5-.3-.8C4.4 15.4 6 13.5 6 9Z" fill="currentColor" />
          <path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {data.unread > 0 && <span className="bell-count">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-pop fade-in" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={readAll}>
                Mark all read
              </button>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="muted bell-empty">No notifications yet.</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n._id}>
                  <button className={`bell-item${n.read ? "" : " unread"}`} onClick={() => openItem(n)}>
                    <strong>{n.title}</strong>
                    <span>{n.message}</span>
                    <small>{formatDateTime(n.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
