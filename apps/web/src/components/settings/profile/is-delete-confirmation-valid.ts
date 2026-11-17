export function isDeleteConfirmationValid(
  confirmation: string,
  email: string | null | undefined,
) {
  return (
    confirmation.trim().toLowerCase() === (email || "DELETE").toLowerCase()
  );
}
