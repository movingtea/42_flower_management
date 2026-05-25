import { redirect } from "next/navigation";

export default function LegacyWmsBomRedirect() {
  redirect("/wms/recipes");
}
