"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { homeFor } from "@/utils/budgetDescribe";
import { Skeleton } from "@/components/ui/Ui";

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    router.replace(!user ? "/login" : homeFor(user.role));
  }, [ready, user, router]);
  return (
    <div className="boot">
      <Skeleton rows={3} />
    </div>
  );
}
