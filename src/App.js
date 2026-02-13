// ✅ src/App.js
import React, { useEffect, useState } from "react";
import "./index.css";

import NoticesPage from "./pages/NoticesPage";
import HolidaysPage from "./pages/HolidaysPage";
import PointsPage from "./pages/PointsPage";
import EnrollmentsPage from "./pages/EnrollmentsPage";

// ✅ (추가) 수강신청 학생별/클래스타입별 페이지
import EnrollmentsByStudentPage from "./pages/EnrollmentsByStudentPage";

// 🔽 새로 추가된 페이지들
import StudentsPage from "./pages/StudentsPage";
import BooksCommentsPage from "./pages/BooksCommentsPage";

// 🔽 결제 관리 페이지
import PaymentsPage from "./pages/PaymentsPage";
import MonthlyPaymentsPage from "./pages/MonthlyPaymentsPage";

import ClassTypesPage from "./pages/ClassTypesPage";

// ✅ 출석부(관리자) 페이지 추가
import AdminAttendanceBookPage from "./pages/AdminAttendanceBookPage.jsx";

const ADMIN_PASSWORD = "0606";

function App() {
  const [authorized, setAuthorized] = useState(false);
  const [inputPassword, setInputPassword] = useState("");

  // ✅ 기본 페이지
  const [activePage, setActivePage] = useState("notices");

  useEffect(() => {
    const saved = localStorage.getItem("admin_login");
    if (saved === "ok") setAuthorized(true);
  }, []);

  if (!authorized) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f3f4f6",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>
          🔐 관리자 로그인
        </h1>

        <input
          type="password"
          placeholder="비밀번호 입력"
          value={inputPassword}
          onChange={(e) => setInputPassword(e.target.value)}
          style={{
            border: "1px solid #d1d5db",
            padding: "8px 10px",
            borderRadius: 4,
            marginBottom: 8,
            width: 200,
          }}
        />

        <button
          onClick={() => {
            if (inputPassword === ADMIN_PASSWORD) {
              localStorage.setItem("admin_login", "ok");
              setAuthorized(true);
            } else {
              alert("비밀번호가 틀렸습니다.");
            }
          }}
          style={{
            background: "#2563eb",
            color: "white",
            padding: "8px 14px",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
          }}
        >
          로그인
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* 상단바 */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: "1px solid #e5e7eb",
          background: "white",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: "bold" }}>
          연상수학 관리자 (mathlove)
        </h1>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            0606 로그인 유지 중
          </span>

          <button
            onClick={() => {
              localStorage.removeItem("admin_login");
              window.location.reload();
            }}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #d1d5db",
              background: "white",
              cursor: "pointer",
            }}
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 본문 */}
      <div style={{ display: "flex" }}>
        {/* 왼쪽 메뉴 */}
        <aside
          style={{
            width: 180,
            borderRight: "1px solid #e5e7eb",
            background: "white",
            padding: 8,
          }}
        >
          <NavItem
            label="공지사항"
            active={activePage === "notices"}
            onClick={() => setActivePage("notices")}
          />

          <NavItem
            label="휴일관리"
            active={activePage === "holidays"}
            onClick={() => setActivePage("holidays")}
          />

          <NavItem
            label="포인트관리"
            active={activePage === "points"}
            onClick={() => setActivePage("points")}
          />

          <NavItem
            label="수강신청(시간표)"
            active={activePage === "enrollments"}
            onClick={() => setActivePage("enrollments")}
          />

          {/* ✅ (추가) 수강신청 학생별/클래스타입별 */}
          <NavItem
            label="수강신청(학생별)"
            active={activePage === "enrollmentsByStudent"}
            onClick={() => setActivePage("enrollmentsByStudent")}
          />

          {/* 🔽 새로 추가된 메뉴들 */}
          <NavItem
            label="학생관리"
            active={activePage === "students"}
            onClick={() => setActivePage("students")}
          />

          <NavItem
            label="반관리"
            active={activePage === "classTypes"}
            onClick={() => setActivePage("classTypes")}
          />

          <NavItem
            label="책 · 코멘트"
            active={activePage === "booksComments"}
            onClick={() => setActivePage("booksComments")}
          />

          {/* 🔽 결제 관리 */}
          <NavItem
            label="결제관리"
            active={activePage === "payments"}
            onClick={() => setActivePage("payments")}
          />

          <NavItem
            label="월별결제관리"
            active={activePage === "monthlyPayments"}
            onClick={() => setActivePage("monthlyPayments")}
          />

          {/* ✅ 출석부(관리자) 메뉴 추가 */}
          <NavItem
            label="출석부(관리자)"
            active={activePage === "adminAttendanceBook"}
            onClick={() => setActivePage("adminAttendanceBook")}
          />
        </aside>

        {/* 오른쪽 콘텐츠 */}
        <main style={{ flex: 1, padding: 16 }}>
          <div
            style={{
              background: "white",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              padding: 12,
            }}
          >
            {activePage === "notices" && <NoticesPage />}
            {activePage === "holidays" && <HolidaysPage />}
            {activePage === "points" && <PointsPage />}

            {/* ✅ 수강신청(시간표) */}
            {activePage === "enrollments" && <EnrollmentsPage />}

            {/* ✅ (추가) 수강신청(학생별) */}
            {activePage === "enrollmentsByStudent" && (
              <EnrollmentsByStudentPage />
            )}

            {/* 🔽 새 페이지 렌더링 */}
            {activePage === "students" && <StudentsPage />}
            {activePage === "classTypes" && <ClassTypesPage />}
            {activePage === "booksComments" && <BooksCommentsPage />}

            {/* 🔽 결제 */}
            {activePage === "payments" && <PaymentsPage />}
            {activePage === "monthlyPayments" && <MonthlyPaymentsPage />}

            {/* ✅ 출석부(관리자) 렌더링 */}
            {activePage === "adminAttendanceBook" && <AdminAttendanceBookPage />}
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        marginBottom: 4,
        borderRadius: 6,
        fontSize: 13,
        border: "none",
        cursor: "pointer",
        background: active ? "#3b82f6" : "white",
        color: active ? "white" : "#374151",
      }}
    >
      {label}
    </button>
  );
}

export default App;
