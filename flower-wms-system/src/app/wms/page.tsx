import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Role } from "@/generated/prisma/enums";
import { getRoleHomePath } from "@/lib/auth-routes";
import { getVisibleNavGroups } from "@/lib/wms-nav";

export default async function WmsIndexPage() {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  if (!role) {
    redirect("/login");
  }

  const firstHref = getVisibleNavGroups(role)[0]?.items[0]?.href;
  redirect(firstHref ?? getRoleHomePath(role));
}
