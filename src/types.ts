export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  age: number;
  ageConfirmed: boolean;
  cookiesAccepted: boolean;
  privacyAccepted: boolean;
  marketingAccepted: boolean;
  createdAt: number;
}

export interface Character {
  id?: string;
  name: string;
  role: string;
  background: string;
  level: number;
  xp: number;
  inventory: string[];
  talents: string[];
  ownerId: string;
  ownerUid?: string;
  isDead: boolean;
  currentPlane?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  authorName?: string;
}

export interface GameInstance {
  id: string;
  code: string;
  location: string;
  createdAt: number;
  status: 'active' | 'archived';
  preferences?: string;
  summary?: string;
}

export interface GameState {
  instance: GameInstance | null;
  character: Character | null;
  messages: Message[];
  characters: Character[];
}
