"use client";

import { createClient } from "@/lib/supabase/client";
import type { Division } from "@/types/database";
import { useEffect, useState } from "react";

export function useDivision() {
  const [division, setDivision] = useState<Division | null>(null);
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: rpcData } = await supabase
        .schema("procurements")
        .rpc("get_user_division_id");
      const id = rpcData as string | null;
      setDivisionId(id);

      if (id) {
        const { data } = await supabase
          .schema("platform")
          .from("divisions")
          .select("*")
          .eq("id", id)
          .single();
        setDivision(data as Division | null);
      }
      setLoading(false);
    }

    load();
  }, []);

  return { division, divisionId, loading };
}
