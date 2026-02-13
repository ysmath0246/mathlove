// ✅ src/pages/EnrollmentsByStudentPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

const dayOrder = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };

function chipStyle(bg, color, borderColor) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color,
    border: `1px solid ${borderColor}`,
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

function safeStr(v) {
  return (v ?? "").toString().trim();
}

function normalizeAppliedFromByStudent(appliedArr = []) {
  // enrollments_by_student 의 applied 배열 구조 대응
  // 예: { day:"화", group:"middle", label:"신청", status:"applied", time:"5시" }
  return (appliedArr || [])
    .filter(Boolean)
    .map((x) => ({
      kind: "slot",
      group: safeStr(x.group),
      day: safeStr(x.day),
      time: safeStr(x.time),
      status: safeStr(x.status || "applied"),
      from: "enrollments_by_student",
    }));
}

export default function EnrollmentsByStudentPage() {
  const [tab, setTab] = useState("student"); // student | classtype
  const [q, setQ] = useState("");
  const [onlyNotApplied, setOnlyNotApplied] = useState(true);
  const [onlyActiveClassType, setOnlyActiveClassType] = useState(true);

  // ✅ 클래스 타입별 보기: category="정규"만 드롭다운
  const [regularClassFilter, setRegularClassFilter] = useState(""); // label

  // =========================
  // ✅ 원본 데이터
  // =========================
  const [students, setStudents] = useState([]);
  const [classTypes, setClassTypes] = useState([]);

  // ✅ 신청 데이터(여러 컬렉션)
  const [newEnrollments, setNewEnrollments] = useState([]); // newenroll
  const [clinicDays, setClinicDays] = useState([]); // middle_clinic_days (문서형)
  const [highEnrollments, setHighEnrollments] = useState([]); // high_enrollments
  const [advancedByStudent, setAdvancedByStudent] = useState([]); // advanced_by_student
  const [enrollByStudent, setEnrollByStudent] = useState([]); // enrollments_by_student (모아둔거)

  // =========================
  // ✅ 실시간 구독
  // =========================
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "students"), (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) =>
        safeStr(a.studentName || a.name).localeCompare(
          safeStr(b.studentName || b.name),
          "ko-KR"
        )
      );
      setStudents(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "class_types"), (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => Number(a.order ?? 999) - Number(b.order ?? 999));
      setClassTypes(list);
    });
    return () => unsub();
  }, []);




  useEffect(() => {
    const unsub = onSnapshot(collection(db, "newenroll"), (qs) => {
      setNewEnrollments(qs.docs.map((d) => ({ id: d.id, ...d.data(), _src: "newenroll" })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "middle_clinic_days"), (qs) => {
      setClinicDays(qs.docs.map((d) => ({ id: d.id, ...d.data() }))); // id=studentId 구조가 보통
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "high_enrollments"), (qs) => {
      setHighEnrollments(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "advanced_by_student"), (qs) => {
      setAdvancedByStudent(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "enrollments_by_student"), (qs) => {
      // 문서 id가 이름인 경우가 많음(예: 구다율)
      setEnrollByStudent(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // =========================
  // ✅ students 기반: name -> sid 매핑 (studentId 없을 때 대비)
  // =========================
  const nameToSid = useMemo(() => {
    const m = new Map();
    students.forEach((s) => {
      const sid = safeStr(s.studentId || s.id);
      const name = safeStr(s.studentName || s.name);
      if (name && sid) m.set(name, sid);
    });
    return m;
  }, [students]);

  // =========================
  // ✅ class_types: (정규) 드롭다운 옵션
  // =========================
  const regularClassTypeOptions = useMemo(() => {
    const list = classTypes.filter((ct) => safeStr(ct.category) === "정규");
    const filtered = onlyActiveClassType ? list.filter((x) => x.isActive !== false) : list;
    return filtered.map((x) => safeStr(x.label || x.name || x.id)).filter(Boolean);
  }, [classTypes, onlyActiveClassType]);

  // =========================
  // ✅ 신청 데이터: studentId 기준으로 통합 + 중복 제거(dedupe)
  // =========================
  const appliedMap = useMemo(() => {
    const map = new Map(); // sid -> item[]
    const seen = new Map(); // sid -> Set(uniqueKey)

    const ensure = (sid) => {
      if (!map.has(sid)) map.set(sid, []);
      if (!seen.has(sid)) seen.set(sid, new Set());
    };

    const pushUnique = (sidRaw, item) => {
      const sid = safeStr(sidRaw);
      if (!sid) return;
      ensure(sid);

      // ✅ 중복 방지 키 (같은 신청이 여러 컬렉션에 있어도 1번만)
      const key = [
        item.kind,
        item.group,
        item.day,
        item.time,
        item.status,
        item.clinicKey || "",
        item.from || "",
      ].join("|");

      const set = seen.get(sid);
      if (set.has(key)) return;
      set.add(key);

      map.get(sid).push(item);
    };

    // 0) enrollments_by_student (모아둔거)
    // - sid가 없을 수도 있어서 name으로 sid 찾기
    enrollByStudent.forEach((d) => {
      const sid =
        safeStr(d.studentId) ||
        (safeStr(d.studentName || d.id) ? nameToSid.get(safeStr(d.studentName || d.id)) : "") ||
        "";
      const items = normalizeAppliedFromByStudent(d.applied || []);
      items.forEach((it) => pushUnique(sid, it));
    });



    // 3) newenroll
    newEnrollments.forEach((e) => {
      const sid =
        safeStr(e.studentId) ||
        (safeStr(e.studentName || e.name) ? nameToSid.get(safeStr(e.studentName || e.name)) : "") ||
        "";
      if (!sid) return;

      pushUnique(sid, {
        kind: "slot",
        group: safeStr(e.group),
        day: safeStr(e.day),
        time: safeStr(e.time),
        status: safeStr(e.status || "applied"),
        from: "newenroll",
      });
    });

    // 4) middle_clinic_days (regular/extra)
    clinicDays.forEach((d) => {
      const sid = safeStr(d.studentId || d.id); // 보통 문서 id=studentId
      if (!sid) return;

      ["regular", "extra"].forEach((k) => {
        const it = d?.[k];
        if (!it) return;

        pushUnique(sid, {
          kind: "clinic",
          group: "middleClinic",
          day: safeStr(it.day),
          time: safeStr(it.blockId || it.time || ""), // A/B
          status: "applied",
          clinicKey: k,
          from: "middle_clinic_days",
        });
      });
    });

    // 5) high_enrollments (요일만)
    highEnrollments.forEach((h) => {
      const sid =
        safeStr(h.studentId) ||
        (safeStr(h.studentName || h.name) ? nameToSid.get(safeStr(h.studentName || h.name)) : "") ||
        "";
      if (!sid) return;

      pushUnique(sid, {
        kind: "high",
        group: "high",
        day: safeStr(h.day),
        time: "",
        status: "applied",
        from: "high_enrollments",
      });
    });

    // 6) advanced_by_student (심화: applied true/false)
    advancedByStudent.forEach((a) => {
      const sid =
        safeStr(a.studentId || a.id) ||
        (safeStr(a.studentName || a.name) ? nameToSid.get(safeStr(a.studentName || a.name)) : "") ||
        "";
      if (!sid) return;

      pushUnique(sid, {
        kind: "advanced",
        group: "advanced",
        day: "",
        time: "",
        status: a.applied ? "applied" : "not_applied",
        from: "advanced_by_student",
      });
    });

    // ✅ 정렬
    const groupOrder = {
      intensive: 1,
      elementary: 2,
      middle: 3,
      middleClinic: 4,
      high: 5,
      advanced: 6,
    };

    map.forEach((arr) => {
      arr.sort((x, y) => {
        const gx = groupOrder[x.group] ?? 99;
        const gy = groupOrder[y.group] ?? 99;
        if (gx !== gy) return gx - gy;

        const dx = dayOrder[x.day] ?? 99;
        const dy = dayOrder[y.day] ?? 99;
        if (dx !== dy) return dx - dy;

        return safeStr(x.time).localeCompare(safeStr(y.time), "ko-KR");
      });
    });

    return map;
  }, [
    enrollByStudent,
    newEnrollments,
    clinicDays,
    highEnrollments,
    advancedByStudent,
    nameToSid,
  ]);

  // =========================
  // ✅ 학생 rows (students 기준: 신청 안 한 애도 무조건 포함)
  // =========================
  const studentRows = useMemo(() => {
    const keyword = safeStr(q).toLowerCase();

    const rows = students.map((s) => {
      const sid = safeStr(s.studentId || s.id);
      const name = safeStr(s.studentName || s.name);

      // ✅ students에 있는 classTypes 배열(라벨들)
      const classTypesArr = Array.isArray(s.classTypes) ? s.classTypes.filter(Boolean) : [];
      const classTypesLabelText = classTypesArr.map((x) => safeStr(x)).filter(Boolean).join(", ");

      const items = appliedMap.get(sid) || [];

      const hasApplied =
        items.some((it) => it.kind !== "advanced") ||
        items.some((it) => it.kind === "advanced" && it.status === "applied");

      const hay = `${name} ${sid} ${classTypesLabelText}`.toLowerCase();
      const hit = !keyword || hay.includes(keyword);

      return {
        sid,
        name,
        classTypesArr: classTypesArr.map((x) => safeStr(x)).filter(Boolean),
        classTypesLabelText,
        items,
        hasApplied,
        hit,
      };
    });

    // 기본: 미신청 먼저, 그 다음 이름순
    rows.sort((a, b) => {
      if (a.hasApplied !== b.hasApplied) return a.hasApplied ? 1 : -1;
      return safeStr(a.name).localeCompare(safeStr(b.name), "ko-KR");
    });

    return rows.filter((r) => r.hit);
  }, [students, q, appliedMap]);

  const filteredStudentRows = useMemo(() => {
    return onlyNotApplied ? studentRows.filter((r) => !r.hasApplied) : studentRows;
  }, [studentRows, onlyNotApplied]);

  // =========================
  // ✅ 클래스 타입별 그룹핑 (students.classTypes 기준)
  // - 드롭다운(정규)로 특정 클래스만 보기 가능
  // =========================
  const byClassType = useMemo(() => {
    const map = new Map(); // label -> rows[]
    filteredStudentRows.forEach((r) => {
      // 학생이 여러 classTypes면 각각 그룹에 들어가게
      const labels = r.classTypesArr.length ? r.classTypesArr : ["미분류"];
      labels.forEach((label) => {
        const key = safeStr(label) || "미분류";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      });
    });

    let orderedLabels = Array.from(map.keys());

    // ✅ 정규 드롭다운 필터 적용
    if (regularClassFilter) {
      orderedLabels = orderedLabels.filter((x) => x === regularClassFilter);
    }

    // 이름순으로 보기 좋게
    orderedLabels.sort((a, b) => safeStr(a).localeCompare(safeStr(b), "ko-KR"));

    return { map, orderedLabels };
  }, [filteredStudentRows, regularClassFilter]);

  // =========================
  // ✅ 칩 렌더
  // =========================
  const renderItems = (items = []) => {
    if (!items || items.length === 0) return <span style={{ color: "#9ca3af" }}>—</span>;

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((it, idx) => {
          // ✅ 심화는 무조건 빨간색
          if (it.kind === "advanced") {
            const isApplied = it.status === "applied";
            return (
              <span
                key={`chip-adv-${idx}`}
                style={chipStyle(
                  isApplied ? "#fecaca" : "#fee2e2",
                  "#991b1b",
                  "rgba(220,38,38,0.25)"
                )}
              >
                심화: {isApplied ? "신청" : "미신청"}
              </span>
            );
          }

          if (it.kind === "high") {
            return (
              <span
                key={`chip-high-${idx}`}
                style={chipStyle("#e0e7ff", "#3730a3", "rgba(67,56,202,0.18)")}
              >
                고등: {it.day}
              </span>
            );
          }

          if (it.kind === "clinic") {
            return (
              <span
                key={`chip-clinic-${idx}`}
                style={chipStyle("#fef3c7", "#92400e", "rgba(146,64,14,0.18)")}
              >
                클리닉: {it.day} {it.time}
                {it.clinicKey ? `(${it.clinicKey})` : ""}
              </span>
            );
          }

          // slot
          const g = safeStr(it.group);
          const gLabel =
            g === "intensive"
              ? "집중"
              : g === "elementary"
              ? "초등"
              : g === "middle"
              ? "중등"
              : g || "슬롯";

          const st = it.status === "reserve" ? "예비" : "신청";
          const bg = it.status === "reserve" ? "#fef3c7" : "#dcfce7";
          const color = it.status === "reserve" ? "#92400e" : "#166534";
          const border =
            it.status === "reserve" ? "rgba(146,64,14,0.18)" : "rgba(22,101,52,0.18)";

          return (
            <span key={`chip-slot-${idx}`} style={chipStyle(bg, color, border)}>
              {gLabel}: {it.day} {it.time} · {st}
            </span>
          );
        })}
      </div>
    );
  };

  const totalCount = studentRows.length;
  const notAppliedCount = studentRows.filter((r) => !r.hasApplied).length;

  return (
    <div style={{ fontSize: 13 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>
            수강신청 · 학생별/클래스별
          </h2>
          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
            전체 {totalCount}명 ·{" "}
            <span style={{ color: "#dc2626", fontWeight: 900 }}>
              미신청 {notAppliedCount}명
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", borderRadius: 999, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setTab("student")}
              style={{
                padding: "6px 12px",
                border: "none",
                cursor: "pointer",
                background: tab === "student" ? "#2563eb" : "white",
                color: tab === "student" ? "white" : "#374151",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              학생별 보기
            </button>
            <button
              type="button"
              onClick={() => setTab("classtype")}
              style={{
                padding: "6px 12px",
                border: "none",
                cursor: "pointer",
                background: tab === "classtype" ? "#2563eb" : "white",
                color: tab === "classtype" ? "white" : "#374151",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              클래스별 보기
            </button>
          </div>

          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151" }}>
            <input type="checkbox" checked={onlyNotApplied} onChange={(e) => setOnlyNotApplied(e.target.checked)} />
            미신청만 보기
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151" }}>
            <input type="checkbox" checked={onlyActiveClassType} onChange={(e) => setOnlyActiveClassType(e.target.checked)} />
            isActive만(class_types)
          </label>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 / studentId / 클래스 검색"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              fontSize: 12,
              width: 260,
              background: "white",
            }}
          />
        </div>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, background: "white", padding: 10 }}>
        {tab === "student" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb", width: 90 }}>상태</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb", width: 170 }}>학생</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb", width: 240 }}>학생 classTypes</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>신청 내역</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudentRows.map((r) => {
                  const badge = r.hasApplied
                    ? chipStyle("#dcfce7", "#166534", "rgba(22,101,52,0.18)")
                    : chipStyle("#fee2e2", "#991b1b", "rgba(220,38,38,0.20)");

                  return (
                    <tr key={`row-${r.sid}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: 10, verticalAlign: "top" }}>
                        <span style={badge}>{r.hasApplied ? "신청완료" : "미신청"}</span>
                      </td>
                      <td style={{ padding: 10, verticalAlign: "top" }}>
                        <div style={{ fontWeight: 900 }}>{r.name || "-"}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{r.sid}</div>
                      </td>
                      <td style={{ padding: 10, verticalAlign: "top" }}>
                        {r.classTypesArr.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {r.classTypesArr.map((x, i) => (
                              <span
                                key={`ct-${r.sid}-${i}`}
                                style={chipStyle("#eef2ff", "#3730a3", "rgba(67,56,202,0.18)")}
                              >
                                {x}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>미분류</span>
                        )}
                      </td>
                      <td style={{ padding: 10 }}>{renderItems(r.items)}</td>
                    </tr>
                  );
                })}
                {filteredStudentRows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 16, color: "#9ca3af" }}>
                      표시할 학생이 없어요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "classtype" && (
          <div>
            {/* ✅ 정규(category="정규") 드롭다운 필터 */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ fontWeight: 900 }}>정규 클래스 선택</div>
              <select
                value={regularClassFilter}
                onChange={(e) => setRegularClassFilter(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  background: "white",
                  fontSize: 12,
                  minWidth: 220,
                }}
              >
                <option value="">(전체 보기)</option>
                {regularClassTypeOptions.map((label) => (
                  <option key={`opt-${label}`} value={label}>
                    {label}
                  </option>
                ))}
              </select>

              <span style={{ fontSize: 12, color: "#6b7280" }}>
                ※ class_types 에서 category="정규" 인 label만 나옵니다.
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {byClassType.orderedLabels.map((label) => {
                const list = byClassType.map.get(label) || [];
                if (list.length === 0) return null;

                const notApplied = list.filter((x) => !x.hasApplied).length;
                const total = list.length;

                return (
                  <div key={`ct-${label}`} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontWeight: 900, fontSize: 14 }}>{label}</div>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>
                          {total}명 · <span style={{ color: "#dc2626", fontWeight: 900 }}>미신청 {notApplied}명</span>
                        </span>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {list.map((r) => {
                        const badge = r.hasApplied
                          ? chipStyle("#dcfce7", "#166534", "rgba(22,101,52,0.18)")
                          : chipStyle("#fee2e2", "#991b1b", "rgba(220,38,38,0.20)");

                        return (
                          <div
                            key={`ct-item-${label}-${r.sid}`}
                            style={{
                              border: "1px solid #e5e7eb",
                              borderRadius: 12,
                              padding: 10,
                              minWidth: 260,
                              background: "white",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                              <div>
                                <div style={{ fontWeight: 900 }}>{r.name || "-"}</div>
                                <div style={{ fontSize: 11, color: "#6b7280" }}>{r.sid}</div>
                              </div>
                              <span style={badge}>{r.hasApplied ? "신청" : "미신청"}</span>
                            </div>

                            <div style={{ marginTop: 8 }}>{renderItems(r.items)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
