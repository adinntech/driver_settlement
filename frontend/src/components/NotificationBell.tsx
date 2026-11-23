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
      <button className="icon-btn bell-btn" onClick={() => { setOpen(!open); if (!open) load(); }} aria-label={`Notifications, ${data.unread} unread`} aria-expanded={open}>
        <span aria-hidden>🔔</span>
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
