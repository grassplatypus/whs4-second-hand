import { requireAdminPage } from "@/features/admin/guard";
import { ReportList } from "@/features/admin/ReportList";

// 관리자만. 가드가 인증·ADMIN·탈퇴를 확인한 뒤 신고 큐를 렌더한다(목록은 ReportList가 GET한다).
export default async function AdminReportsPage() {
  await requireAdminPage();

  return (
    <main className="flex flex-1 flex-col items-center py-12">
      <ReportList />
    </main>
  );
}
