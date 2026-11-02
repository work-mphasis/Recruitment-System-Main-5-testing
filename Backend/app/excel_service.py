import pandas as pd
import os
import math

def get_excel_file():
    data_folder = os.path.join(os.path.dirname(__file__), "..", "data")

    for file in os.listdir(data_folder):
        if file.endswith(".xlsx"):
            return os.path.join(data_folder, file)

    raise Exception("No Excel file found")

def read_data():
    file_path = get_excel_file()

    df = pd.read_excel(file_path, sheet_name=0)

    # 🔥 FIX: Replace NaN, infinity, etc.
    df = df.replace({math.nan: None})
    df = df.where(pd.notnull(df), None)

    return df.to_dict(orient="records")