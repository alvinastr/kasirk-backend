import { Prisma } from '@prisma/client';

type AdapterConstraint = {
  fields?: unknown;
  index?: unknown;
};

type UniqueConstraintMeta = {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: AdapterConstraint | string;
    };
  };
};

export function isUniqueConstraintViolation(
  error: unknown,
  constraintName: string,
  expectedFields: readonly string[],
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }

  const meta = error.meta as UniqueConstraintMeta | undefined;
  const adapterConstraint = meta?.driverAdapterError?.cause?.constraint;
  const adapterIndex =
    typeof adapterConstraint === 'string'
      ? adapterConstraint
      : adapterConstraint?.index;

  if (meta?.target === constraintName || adapterIndex === constraintName) {
    return true;
  }

  const targetFields = Array.isArray(meta?.target)
    ? meta.target
    : typeof adapterConstraint === 'object'
      ? adapterConstraint.fields
      : undefined;

  if (
    !Array.isArray(targetFields) ||
    targetFields.length !== expectedFields.length ||
    !targetFields.every((field): field is string => typeof field === 'string')
  ) {
    return false;
  }

  return expectedFields.every((field) => targetFields.includes(field));
}
