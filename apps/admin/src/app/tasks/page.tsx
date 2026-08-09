import { TasksStudio } from "./TasksStudio";

export default function TasksPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Taken</h1>
          <p>
            Plan geplande AI-taken voor deze website: kies een prompt of macro,
            stel herhaling en tijdstip in, en bekijk de laatste status. Taken
            draaien onbeheerd als draft (niet publiceren).
          </p>
        </div>
      </div>
      <TasksStudio />
    </>
  );
}
