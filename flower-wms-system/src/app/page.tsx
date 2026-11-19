import { redirect } from "next/navigation";
import { V2_HOME_PATH } from "@/auth.config";

/** The default site entry is the v2 workbench; legacy routes stay explicit URLs. */
export default function RootPage() {
  redirect(V2_HOME_PATH);
}
