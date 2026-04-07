import { APIClient, SendEmailRequest } from "customerio-node";

function getClient() {
  const key = process.env.CUSTOMER_IO_API_KEY;
  if (!key) {
    throw new Error("CUSTOMER_IO_API_KEY is not set");
  }
  return new APIClient(key);
}

export const sendTransactionalEmail = async ({
  transactionalMessageId,
  messageData,
  to,
  from,
  subject,
  body,
  identifiers,
  attachments,
}: {
  transactionalMessageId: string;
  messageData: Record<string, any>;
  to: string;
  identifiers: {
    email: string;
  };
  from?: string;
  subject?: string;
  body?: string;
  attachments?: { filename: string; data: Buffer }[];
}) => {
  const opts = {
    transactional_message_id: transactionalMessageId,
    message_data: messageData,
    identifiers,
    to,
    ...(from ? { from } : {}),
    ...(subject ? { subject } : {}),
    ...(body ? { body } : {}),
  } as ConstructorParameters<typeof SendEmailRequest>[0];

  const request = new SendEmailRequest(opts);
  for (const a of attachments || []) {
    request.attach(a.filename, a.data);
  }
  if (!request.message.attachments || Object.keys(request.message.attachments).length === 0) {
    (request.message as { attachments?: Record<string, string> }).attachments = undefined;
  }
  try {
    const response = await getClient().sendEmail(request);
    return response;
  } catch (err: any) {
    console.error("Email send failed:", err.statusCode, err.message);
    throw err;
  }
};
