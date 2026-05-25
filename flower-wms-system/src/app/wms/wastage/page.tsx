import { redirect } from "next/navigation";

export default function WastageRedirectPage() {
  redirect("/wms/operations?panel=loss");
}
