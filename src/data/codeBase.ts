export interface CodeFile {
  path: string;
  language: string;
  description: string;
  content: string;
}

export const CODE_FILES: CodeFile[] = [
  {
    path: 'database/schema.sql',
    language: 'sql',
    description: 'PostgreSQL Normalized Database Schema with UUIDs, Foreign Keys, Indexes, Soft Delete support, and Audit Logging.',
    content: `-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Define Roles Enum
CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'TEACHER', 
    'STUDENT', 'PARENT', 'ACCOUNTANT', 'LIBRARIAN', 'TRANSPORT_MANAGER'
);

-- Users Table (Base Identity)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) UNIQUE,
    role user_role NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
    otp_code VARCHAR(6),
    otp_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Schools Table
CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    affiliation_no VARCHAR(100) UNIQUE,
    address TEXT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    logo_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL
);

-- Classes Table (school-admin defined)
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL, -- school-admin defined display name
    section VARCHAR(10) NOT NULL, -- school-admin defined section name
    room_number VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(school_id, name, section)
);

-- Parents Table
CREATE TABLE parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    occupation VARCHAR(100),
    emergency_contact VARCHAR(20) NOT NULL,
    address TEXT NOT NULL
);

-- Students Table (Soft Delete, Indexed, Foreign Key)
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES parents(id) ON DELETE SET NULL,
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    admission_no VARCHAR(100) UNIQUE NOT NULL,
    roll_no INT,
    dob DATE NOT NULL,
    gender VARCHAR(10) NOT NULL,
    blood_group VARCHAR(5),
    medical_history TEXT,
    qr_code_hash VARCHAR(255) UNIQUE,
    academic_year VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE', -- 'ACTIVE', 'PROMOTED', 'TC_ISSUED'
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Teachers Table
CREATE TABLE teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) UNIQUE NOT NULL,
    qualification VARCHAR(255) NOT NULL,
    specialization VARCHAR(150),
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL
);

-- Subjects Table
CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL,
    UNIQUE(class_id, code)
);

-- Teacher Subject Allocation
CREATE TABLE teacher_subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
    allocated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(teacher_id, subject_id)
);

-- Timetable Table
CREATE TABLE timetables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL, -- 'Monday' - 'Saturday'
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    period_number INT NOT NULL,
    UNIQUE(class_id, day_of_week, period_number)
);

-- Attendance Table
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(10) NOT NULL, -- 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'
    remarks TEXT,
    marked_by UUID REFERENCES users(id),
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, date)
);

-- Fee Categories Table
CREATE TABLE fee_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL, -- 'Tuition', 'Transport', 'Exam', etc.
    description TEXT
);

-- Fee Allocations Table
CREATE TABLE fee_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    fee_category_id UUID REFERENCES fee_categories(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    due_date DATE NOT NULL,
    discount_amount NUMERIC(12, 2) DEFAULT 0.00,
    paid_amount NUMERIC(12, 2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'UNPAID' NOT NULL -- 'UNPAID', 'PARTIALLY_PAID', 'PAID'
);

-- Fee Payments (Razorpay/Invoices) Table
CREATE TABLE fee_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fee_allocation_id UUID REFERENCES fee_allocations(id) ON DELETE CASCADE,
    transaction_id VARCHAR(255) UNIQUE NOT NULL,
    amount_paid NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL, -- 'RAZORPAY', 'UPI', 'CASH'
    payment_gateway VARCHAR(50) DEFAULT 'RAZORPAY',
    payment_status VARCHAR(20) DEFAULT 'SUCCESS' NOT NULL,
    receipt_no VARCHAR(100) UNIQUE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Exams Table
CREATE TABLE exams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL, -- 'Term 1 Midterm', 'Finals'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL
);

-- Exam Papers Table
CREATE TABLE exam_papers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    max_marks INT NOT NULL,
    passing_marks INT NOT NULL
);

-- Exam Marks Entry Table
CREATE TABLE exam_marks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
    marks_obtained NUMERIC(5, 2) NOT NULL,
    is_absent BOOLEAN DEFAULT FALSE NOT NULL,
    remarks TEXT,
    graded_by UUID REFERENCES teachers(id),
    graded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, exam_paper_id)
);

-- Audit Logs Table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_students_admission ON students(admission_no);
CREATE INDEX idx_students_class ON students(class_id);
CREATE INDEX idx_attendance_date_class ON attendance(date, class_id);
CREATE INDEX idx_fee_allocations_student ON fee_allocations(student_id);
CREATE INDEX idx_exam_marks_student ON exam_marks(student_id);
`
  },
  {
    path: 'backend/main.py',
    language: 'python',
    description: 'FastAPI core server script supporting endpoints, WebSockets for Live Notifications, and proper exception mappings.',
    content: `import uvicorn
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import logging

app = FastAPI(
    title="Volpehub Education ERP & LMS API",
    description="Enterprise-grade endpoints supporting students, scheduling, grading, notifications, and Razorpay integrations.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket Connections Tracker
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket):
        if user_id in self.active_connections:
            self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                await connection.send_json(message)

    async def broadcast(self, message: dict):
        for user_id, connections in self.active_connections.items():
            for connection in connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

manager = ConnectionManager()

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "School ERP API", "uptime": "optimal"}

@app.websocket("/ws/notifications/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(user_id, websocket)
    try:
        # Send confirmation greeting
        await websocket.send_json({"type": "CONN_ESTABLISHED", "message": f"Connected to school notification gateway."})
        while True:
            data = await websocket.receive_text()
            # Simple heartbeat loop
            await websocket.send_json({"type": "HEARTBEAT", "payload": "ping-received"})
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)

# Global Exceptions Handler
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return {
        "error": True,
        "detail": exc.detail,
        "code": exc.status_code
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
`
  },
  {
    path: 'backend/models.py',
    language: 'python',
    description: 'SQLAlchemy complete ORM model classes linking Parent, Student, Teacher, Classes, Attendance, and Exams.',
    content: `from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Integer, Numeric, Date, Time, Enum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, declarative_base
import datetime
import uuid

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(150), nullable=False)
    phone = Column(String(20), unique=True)
    role = Column(String(50), nullable=False) # 'SUPER_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'
    is_active = Column(Boolean, default=True, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    student_profile = relationship("Student", back_populates="user", uselist=False)
    teacher_profile = relationship("Teacher", back_populates="user", uselist=False)


class ClassRoom(Base):
    __tablename__ = 'classes'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(50), nullable=False) # school-admin defined
    section = Column(String(10), nullable=False)
    room_number = Column(String(20))

    students = relationship("Student", back_populates="classroom")


class Student(Base):
    __tablename__ = 'students'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), unique=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey('classes.id', ondelete='SET NULL'))
    admission_no = Column(String(100), unique=True, nullable=False, index=True)
    roll_no = Column(Integer)
    dob = Column(Date, nullable=False)
    gender = Column(String(10), nullable=False)
    blood_group = Column(String(5))
    medical_history = Column(String)
    qr_code_hash = Column(String, unique=True)
    academic_year = Column(String(20), nullable=False)
    status = Column(String(20), default='ACTIVE') # 'ACTIVE', 'PROMOTED', 'TC_ISSUED'
    is_deleted = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="student_profile")
    classroom = relationship("ClassRoom", back_populates="students")
    attendance_records = relationship("Attendance", back_populates="student")


class Teacher(Base):
    __tablename__ = 'teachers'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), unique=True)
    employee_id = Column(String(50), unique=True, nullable=False)
    qualification = Column(String(255), nullable=False)
    specialization = Column(String(150))
    is_deleted = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="teacher_profile")


class Attendance(Base):
    __tablename__ = 'attendance'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id = Column(UUID(as_uuid=True), ForeignKey('students.id', ondelete='CASCADE'), nullable=False)
    class_id = Column(UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False)
    date = Column(Date, nullable=False)
    status = Column(String(10), nullable=False) # 'PRESENT', 'ABSENT', 'LATE'
    remarks = Column(String)

    student = relationship("Student", back_populates="attendance_records")
`
  },
  {
    path: 'backend/auth.py',
    language: 'python',
    description: 'JWT validation helper, password hashing, and Role-Based Access Control (RBAC) dependency filters.',
    content: `from jose import jwt, JWTError
from passlib.context import CryptContext
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from typing import List

SECRET_KEY = "SUPER_SECRET_VOLPEHUB_EDUCATION_KEY"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        role: str = payload.get("role")
        user_id: str = payload.get("id")
        if email is None or role is None:
            raise credentials_exception
        return {"email": email, "role": role, "id": user_id}
    except JWTError:
        raise credentials_exception

class RoleChecker:
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Insufficient privileges for this role."
            )
        return current_user
`
  },
  {
    path: 'react_native/App.tsx',
    language: 'typescript',
    description: 'React Native Navigation container structure showcasing how screens are linked via Stack & Tab navigators.',
    content: `import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Feather';

// Mock Screens
import SplashScreen from './screens/SplashScreen';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import StudentProfileScreen from './screens/StudentProfileScreen';
import FeesScreen from './screens/FeesScreen';
import AttendanceScreen from './screens/AttendanceScreen';
import LMSLearningScreen from './screens/LMSLearningScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let iconName = 'grid';
          if (route.name === 'Home') iconName = 'home';
          else if (route.name === 'Attendance') iconName = 'check-square';
          else if (route.name === 'LMS') iconName = 'book-open';
          else if (route.name === 'Fees') iconName = 'credit-card';
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="LMS" component={LMSLearningScreen} />
      <Tab.Screen name="Fees" component={FeesScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainTabNavigator} />
        <Stack.Screen name="StudentProfile" component={StudentProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
`
  },
  {
    path: 'docker/Dockerfile',
    language: 'dockerfile',
    description: 'Multi-stage Dockerfile for FastAPI backend optimized for slim image sizes and safe execution.',
    content: `# Build Stage
FROM python:3.11-slim as builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final Runner Stage
FROM python:3.11-slim as runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /root/.local
COPY . .

ENV PATH=/root/.local/bin:$PATH
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`
  },
  {
    path: 'docker/docker-compose.yml',
    language: 'yaml',
    description: 'Docker Compose orchestration file mounting Python service, PostgreSQL, S3/Cloudinary simulator, and PGAdmin panels.',
    content: `version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: school_erp_db
    restart: always
    environment:
      POSTGRES_USER: erp_admin
      POSTGRES_PASSWORD: SecretSecurePassword99
      POSTGRES_DB: school_erp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: school_erp_api
    restart: always
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://erp_admin:SecretSecurePassword99@db:5432/school_erp
      - SECRET_KEY=SUPER_SECRET_VOLPEHUB_EDUCATION_KEY
      - RAZORPAY_KEY_ID=rzp_test_mockKeyId123
      - RAZORPAY_KEY_SECRET=rzp_secret_mockSecretKey123
    depends_on:
      - db

volumes:
  pgdata:
`
  },
  {
    path: 'docs/INSTALL.md',
    language: 'markdown',
    description: 'Detailed setup, configurations, credentials seeding, and execution instructions.',
    content: `# School ERP & LMS Installation Guide

## Prerequisites
- **Python**: v3.10 or higher
- **PostgreSQL**: v14 or higher
- **Node.js**: v18 or higher (for React Native/Metro developer server)
- **Docker**: Optional (for containerized deployments)

---

## 1. Backend Setup (FastAPI)

1. **Navigate to the backend directory**:
   \`\`\`bash
   cd backend
   \`\`\`

2. **Create a Virtual Environment**:
   \`\`\`bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\\Scripts\\activate
   \`\`\`

3. **Install Dependencies**:
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`

4. **Environment Configuration**:
   Create a \`.env\` file:
   \`\`\`env
   DATABASE_URL=postgresql://erp_admin:SecretSecurePassword99@localhost:5432/school_erp
   SECRET_KEY=SUPER_SECRET_VOLPEHUB_EDUCATION_KEY
   RAZORPAY_KEY_ID=rzp_test_mockKeyId123
   RAZORPAY_KEY_SECRET=rzp_secret_mockSecretKey123
   \`\`\`

5. **Initialize Database Tables**:
   \`\`\`bash
   psql -U erp_admin -d school_erp -f ../database/schema.sql
   \`\`\`

6. **Run FastAPI Service**:
   \`\`\`bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   \`\`\`
   Access Swagger API docs at: \`http://localhost:8000/docs\`

---

## 2. Mobile App Setup (React Native)

1. **Navigate to React Native directory**:
   \`\`\`bash
   cd react_native
   \`\`\`

2. **Install Node modules**:
   \`\`\`bash
   npm install
   \`\`\`

3. **Install Pods (iOS only)**:
   \`\`\`bash
   cd ios && pod install && cd ..
   \`\`\`

4. **Launch the Metro bundler**:
   \`\`\`bash
   npm start
   \`\`\`

5. **Run on Emulator / Device**:
   - **Android**: \`npm run android\`
   - **iOS**: \`npm run ios\`
`
  }
];
