import { requireAdminPage } from "@/features/admin/guard";
import { DisputeList } from "@/features/admin/DisputeList";

// 관리자만. 가드가 인증·ADMIN·탈퇴를 확인한 뒤 분쟁 목록을 렌더한다(목록은 DisputeList가 GET한다).
export default async function AdminDisputesPage() {
  await requireAdminPage();

  return (
    <main className="flex flex-1 flex-col items-center py-12">
      <DisputeList />
    </main>
  );
}
