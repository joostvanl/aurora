import { MediaStudio } from "./MediaStudio";

export default function MediaPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Media storage</h1>
          <p>
            Configure where uploaded images are stored for this website — local
            disk or ImageKit CDN.
          </p>
        </div>
      </div>
      <MediaStudio />
    </>
  );
}
