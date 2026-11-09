import type { Prisma } from "../../generated/prisma-v2/client";

export const auditRollbackError = "test failure after audit write";

export function failAfterAudit(tx: Prisma.TransactionClient, action: string): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property !== "auditEvent") return Reflect.get(target, property, receiver);
      return {
        async create(args: Prisma.AuditEventCreateArgs) {
          const audit = await target.auditEvent.create(args);
          if (args.data.action === action) throw new Error(auditRollbackError);
          return audit;
        },
      };
    },
  });
}
