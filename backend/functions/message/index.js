const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, DeleteCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
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

  // ── Ping keepalive ──
  if (type === "ping") {
    return { statusCode: 200, body: "pong" };
  }

  // ── Register device ──
  if (type === "register") {
    const { clientId, deviceName, deviceType } = body;
    const ttl = Math.floor(Date.now() / 1000) + 86400;
    await db.send(new PutCommand({
      TableName: process.env.DEVICES_TABLE,
      Item: { clientId, connectionId, deviceName, deviceType, status: "online", ttl }
    }));
    return { statusCode: 200, body: "Registered" };
  }

  // ── Create room (sender selects file) ──
  if (type === "create-room") {
    const { roomCode, fileName, fileSize } = body;
    const ttl = Math.floor(Date.now() / 1000) + 300; // 5 min expiry

    await db.send(new PutCommand({
      TableName: process.env.ROOMS_TABLE,
      Item: {
        roomCode,
        senderConnectionId: connectionId,
        fileName,
        fileSize,
        status: "waiting",
        createdAt: Date.now(),
        ttl
      }
    }));

    return { statusCode: 200, body: "Room created" };
  }

  // ── Join room (receiver enters code) ──
  if (type === "join-room") {
    const { roomCode } = body;

    const result = await db.send(new GetCommand({
      TableName: process.env.ROOMS_TABLE,
      Key: { roomCode }
    }));

    if (!result.Item) {
      await send(apigw, connectionId, {
        type: "room-error",
        message: "Invalid or expired code. Please try again."
      });
      return { statusCode: 404, body: "Room not found" };
    }

    const room = result.Item;

    // Tell sender that receiver joined
    await send(apigw, room.senderConnectionId, {
      type: "receiver-joined",
      receiverConnectionId: connectionId,
      roomCode
    });

    // Tell receiver the file info + sender connectionId
    await send(apigw, connectionId, {
      type: "room-joined",
      fileName: room.fileName,
      fileSize: room.fileSize,
      senderConnectionId: room.senderConnectionId,
      roomCode
    });

    // Update room status
    await db.send(new UpdateCommand({
      TableName: process.env.ROOMS_TABLE,
      Key: { roomCode },
      UpdateExpression: "SET #s = :active, receiverConnectionId = :rcid",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":active": "active", ":rcid": connectionId }
    }));

    return { statusCode: 200, body: "Joined" };
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

  return { statusCode: 400, body: "Unknown type" };
};