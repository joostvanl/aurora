import { MembersManager } from "@/components/MembersManager";

export default function MembersPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Members</h1>
          <p>
            Invite people to this website and assign roles: editor, builder, or
            admin.
          </p>
        </div>
      </div>
      <MembersManager />
    </>
  );
}
