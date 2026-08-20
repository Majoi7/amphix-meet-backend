export interface CreateRoomRequest {
  name?: string;
}

export interface CreateRoomResponse {
  roomId: string;
  roomUrl: string;
}

export interface TokenRequest {
  roomId: string;
  participantName: string;
}

export interface TokenResponse {
  token: string;
  livekitUrl: string;
  roomId: string;
}

export interface ApiError {
  error: string;
  message: string;
}
