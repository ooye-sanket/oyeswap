const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const send = async (apigw, connectionId, data) => {
  try {
    await apigw.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data))
    }));
  } catch (e) {
    if (e.statusCode === 410) {
      await db.send(new DeleteCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        Key: { connectionId }
      }));
    }
  }
};

const broadcastDevices = async (apigw) => {
  const result = await db.send(new ScanCommand({
    TableName: process.env.DEVICES_TABLE,
    FilterExpression: "#s = :online",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":online": "online" }
  }));

  const devices = result.Items || [];
  const connections = await db.send(new ScanCommand({
    TableName: process.env.CONNECTIONS_TABLE
  }));

  for (const conn of (connections.Items || [])) {
    await send(apigw, conn.connectionId, { type: "devices", list: devices });
  }
};

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const domainName = event.requestContext.domainName;
  const stage = event.requestContext.stage;

  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { type } = body;

  if (type === "register") {
    const { clientId, deviceName, deviceType } = body;
    const ttl = Math.floor(Date.now() / 1000) + 86400;
    await db.send(new PutCommand({
      TableName: process.env.DEVICES_TABLE,
      Item: { clientId, connectionId, deviceName, deviceType, status: "online", ttl }
    }));
    await broadcastDevices(apigw);
    return { statusCode: 200, body: "Registered" };
  }

  if (type === "request-approval") {
    const { targetClientId, fileName, fileSize, senderName } = body;
    const target = await db.send(new GetCommand({
      TableName: process.env.DEVICES_TABLE,
      Key: { clientId: targetClientId }
    }));
    if (!target.Item || !target.Item.connectionId) {
      return { statusCode: 404, body: "Target not found" };
    }
    await send(apigw, target.Item.connectionId, {
      type: "approval-request",
      fileName, fileSize, senderName,
      senderConnectionId: connectionId
    });
    return { statusCode: 200, body: "Request sent" };
  }

  if (type === "approval-response") {
    const { senderConnectionId, approved, fileName } = body;
    // ✅ FIX: include receiverConnectionId so sender knows where to send WebRTC offer
    await send(apigw, senderConnectionId, {
      type: "approval-result",
      approved,
      fileName,
      receiverConnectionId: connectionId
    });
    return { statusCode: 200, body: "Response sent" };
  }

  if (type === "webrtc-signal") {
    const { targetConnectionId, signal } = body;
    await send(apigw, targetConnectionId, {
      type: "webrtc-signal",
      signal,
      fromConnectionId: connectionId
    });
    return { statusCode: 200, body: "Signal sent" };
  }

  if (type === "chat") {
    const { targetClientId, message, senderName } = body;
    const safeMessage = message.replace(/[<>]/g, "").substring(0, 1000);
    const target = await db.send(new GetCommand({
      TableName: process.env.DEVICES_TABLE,
      Key: { clientId: targetClientId }
    }));
    if (target.Item && target.Item.connectionId) {
      await send(apigw, target.Item.connectionId, {
        type: "chat",
        message: safeMessage,
        senderName,
        timestamp: Date.now()
      });
    }
    return { statusCode: 200, body: "Chat sent" };
  }

  return { statusCode: 400, body: "Unknown type" };
};