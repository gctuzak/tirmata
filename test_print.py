from printer import print_kitchen_receipt

test_items = [
    {"quantity": 1, "product_name": "Test Kebap", "selected_options": "Aci: Var"},
    {"quantity": 2, "product_name": "Ayran", "selected_options": None},
    {"quantity": 1, "product_name": "Şiş Tavuk", "selected_options": "Pisme Derecesi: Iyi Pismis"}
]

print("Yaziciya (192.168.1.101) test ciktisi gonderiliyor...")
print_kitchen_receipt("TEST MASASI 1", test_items)
print("Islem tamamlandi.")
