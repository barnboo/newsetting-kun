import fitz

doc = fitz.open("uploads/d06c47dc-6c72-4e94-a8c9-64f6a92a3171.pdf")
page = doc[0]

def write_number_before(unit_rect, num_str, color=(0, 0, 0)):
    rect = fitz.Rect(unit_rect.x0 - 45, unit_rect.y0 - 2, unit_rect.x0 - 4, unit_rect.y1 + 2)
    print(f"Calling insert_textbox with rect {rect} and text {num_str}")
    res = page.insert_textbox(rect, str(num_str), fontname="helv", fontsize=11, align=fitz.TEXT_ALIGN_RIGHT, color=color)
    print("insert_textbox returned:", res)

words = page.get_text("words")
chair_count = 42

for w in words:
    text = w[4]
    r = fitz.Rect(w[:4])
    if text == '脚' and 190 < r.y0 < 212 and chair_count > 0:
        print("MATCHED!")
        write_number_before(r, str(chair_count))

doc.save("test_numbers2.pdf")
