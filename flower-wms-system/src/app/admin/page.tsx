import { redirect } from "next/navigation";

/** 旧路径兼容：/admin → 工作台门户 */
export default function LegacyAdminIndexPage() {
  redirect("/");
}
