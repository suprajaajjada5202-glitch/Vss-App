import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { ROLE_LABELS } from "@/lib/permissions";
import { firstOf } from "@/lib/utils";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: profile }, { data: employee }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("employees")
      .select("hire_date, manager:manager_id(user:users(profile:profiles(full_name)))")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const manager = firstOf(employee?.manager);
  const managerName = firstOf(firstOf(manager?.user)?.profile)?.full_name ?? null;

  return (
    <div>
      <PageHeader
        kicker="Account"
        title="My profile"
        description="Your details as colleagues see them in the employee directory."
      />
      <ProfileEditor
        userId={user.id}
        email={user.email}
        employeeCode={user.employeeCode}
        roleLabel={ROLE_LABELS[user.role]}
        hireDate={employee?.hire_date ?? null}
        managerName={managerName}
        values={{
          fullName: profile?.full_name ?? user.fullName,
          phone: profile?.phone ?? "",
          jobTitle: profile?.job_title ?? "",
          department: profile?.department ?? "",
          location: profile?.location ?? "",
          bio: profile?.bio ?? "",
          dateOfBirth: profile?.date_of_birth ?? "",
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
    </div>
  );
}
