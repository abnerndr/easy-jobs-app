import { ProfileForm } from "@/components/profile/profile-form";
import { ResumeUpload } from "@/components/profile/resume-upload";

export default function ProfilePage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-4">Perfil</h1>
        <ProfileForm />
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Currículo</h2>
        <ResumeUpload />
      </div>
    </div>
  );
}
