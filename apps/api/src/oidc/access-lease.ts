export type AccessLease = {
  accessGranted: boolean;
  accessValidUntil: Date | null;
};

/** The local projection fails closed when the control-plane lease expires. */
export function hasCurrentAccess(
  lease: AccessLease,
  now = new Date(),
): boolean {
  return (
    lease.accessGranted &&
    lease.accessValidUntil !== null &&
    lease.accessValidUntil.getTime() > now.getTime()
  );
}
