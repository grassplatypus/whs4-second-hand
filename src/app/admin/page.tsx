import { requireAdminPage } from "@/features/admin/guard";
import { Dashboard } from "@/features/admin/Dashboard";

// 관리자만. 가드가 인증·ADMIN·탈퇴를 확인한 뒤 대시보드를 렌더한다(집계는 Dashboard가 GET한다).
export default async function AdminDashboardPage() {
  await requireAdminPage();

  return (
    <main className="flex flex-1 flex-col items-center py-12">
      <Dashboard />
    </main>
  );
}
