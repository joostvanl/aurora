/**
 * Cursor-style find/replace for string field values.
 * old_string must match uniquely unless replace_all is true.
 */
export function applyStrReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string {
  if (!oldString) {
    throw Object.assign(new Error("old_string must not be empty"), {
      statusCode: 400,
    });
  }

  if (replaceAll) {
    if (!content.includes(oldString)) {
      throw Object.assign(
        new Error("old_string not found in field value"),
        { statusCode: 400 },
      );
    }
    return content.split(oldString).join(newString);
  }

  const first = content.indexOf(oldString);
  if (first === -1) {
    throw Object.assign(new Error("old_string not found in field value"), {
      statusCode: 400,
    });
  }
  const second = content.indexOf(oldString, first + oldString.length);
  if (second !== -1) {
    throw Object.assign(
      new Error(
        "old_string matched multiple times; provide a more specific snippet or set replace_all=true",
      ),
      { statusCode: 400 },
    );
  }

  return (
    content.slice(0, first) + newString + content.slice(first + oldString.length)
  );
}
