import { ActivityType } from "@prisma/client";
import { prisma } from "./prisma";

export function logActivity(params: {
  type: ActivityType;
  message: string;
  userId: string;
  projectId?: string;
  taskId?: string;
}) {
  return prisma.activity.create({ data: params });
}
