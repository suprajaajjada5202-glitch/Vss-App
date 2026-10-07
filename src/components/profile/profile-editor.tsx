"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { changePassword, saveAvatarPath, updateProfile } from "@/lib/actions/profile";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { formatDate } from "@/lib/utils";

const MAX_AVATAR = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function ProfileEditor({
  userId,
  email,
  employeeCode,
  roleLabel,
  hireDate,
  managerName,
  values,
}: {
  userId: string;
  email: string;
  employeeCode: string | null;
  roleLabel: string;
  hireDate: string | null;
  managerName: string | null;
  values: {
    fullName: string;
    phone: string;
    jobTitle: string;
    department: string;
    location: string;
    bio: string;
    dateOfBirth: string;
    avatarUrl: string | null;
  };
}) {
  const router = useRouter();
  const [avatar, setAvatar] = useState(values.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [savingProfile, startProfile] = useTransition();
  const [savingPassword, startPassword] = useTransition();
  const passwordForm = useRef<HTMLFormElement>(null);

  async function onAvatar(file: File) {
    const ext = AVATAR_TYPES[file.type];
    if (!ext) return toast.error("Use a PNG, JPEG, WebP or GIF image");
    if (file.size > MAX_AVATAR) return toast.error("Photos are limited to 2 MB");

    setUploading(true);
    const supabase = createClient();
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (error) {
      setUploading(false);
      return toast.error(error.message);
    }
    const res = await saveAvatarPath(path);
    setUploading(false);
    if ("error" in res && res.error) return toast.error(res.error);
    if ("url" in res && res.url) setAvatar(res.url);
    toast.success("Photo updated");
    router.refresh(); // sidebar / topbar read the profile from the server layout
  }

  const info: [string, string][] = [
    ["Employee ID", employeeCode ?? "—"],
    ["Email", email],
    ["Role", roleLabel],
    ["Joined", formatDate(hireDate)],
    ["Reports to", managerName ?? "—"],
  ];

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
      <div className="space-y-4">
        <div className="bg-panel p-5">
          <Avatar name={values.fullName} src={avatar} size={88} />
          <label className="mt-4 inline-flex h-10 cursor-pointer items-center bg-teal px-3 text-sm text-white hover:bg-teal-deep">
            {uploading ? "Uploading…" : "Upload photo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onAvatar(file);
              }}
            />
          </label>
          <p className="mt-2 text-xs text-muted">PNG, JPEG, WebP or GIF, up to 2 MB.</p>
        </div>
        <dl className="space-y-3 bg-panel p-5 text-sm">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-10">
        <form
          className="grid gap-4 bg-panel p-5 sm:grid-cols-2"
          action={(form) =>
            startProfile(async () => {
              const res = await updateProfile(form);
              if ("error" in res && res.error) toast.error(res.error);
              else {
                toast.success("Profile saved");
                router.refresh();
              }
            })
          }
        >
          <div className="sm:col-span-2">
            <h2 className="text-lg font-medium">Contact details</h2>
          </div>
          <Field label="Full name" htmlFor="fullName">
            <Input id="fullName" name="fullName" defaultValue={values.fullName} required minLength={2} maxLength={120} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={values.phone} maxLength={40} />
          </Field>
          <Field label="Job title" htmlFor="jobTitle">
            <Input id="jobTitle" name="jobTitle" defaultValue={values.jobTitle} maxLength={120} />
          </Field>
          <Field label="Department" htmlFor="department">
            <Input id="department" name="department" defaultValue={values.department} maxLength={120} />
          </Field>
          <Field label="Location" htmlFor="location">
            <Input id="location" name="location" defaultValue={values.location} maxLength={120} />
          </Field>
          <Field label="Date of birth" htmlFor="dateOfBirth">
            <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Bio" htmlFor="bio" hint="Up to 1000 characters.">
              <Textarea id="bio" name="bio" defaultValue={values.bio} maxLength={1000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>

        <form
          id="password"
          ref={passwordForm}
          className="max-w-md scroll-mt-24 space-y-4 bg-panel p-5"
          action={(form) =>
            startPassword(async () => {
              const res = await changePassword(String(form.get("currentPassword")), String(form.get("nextPassword")));
              if ("error" in res && res.error) toast.error(res.error);
              else {
                toast.success("Password updated");
                passwordForm.current?.reset();
                router.refresh(); // clears the temporary-password banner
              }
            })
          }
        >
          <h2 className="text-lg font-medium">Change password</h2>
          <Field label="Current password" htmlFor="currentPassword">
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="nextPassword" hint="At least 8 characters.">
            <Input
              id="nextPassword"
              name="nextPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
            />
          </Field>
          <Button type="submit" variant="copper" disabled={savingPassword}>
            {savingPassword ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
