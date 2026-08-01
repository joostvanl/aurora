import { AiStudio } from "./AiStudio";

export default function AiPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>AI settings</h1>
          <p>
            Configure the OpenAI-compatible provider for this website. Use the
            assistant dock on any page to chat and make CMS changes.
          </p>
        </div>
      </div>
      <AiStudio />
    </>
  );
}
