package com.lazarmarlin.americanatlas.car;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

/** Pick which kind of places Nearby shows. Returns the filter id via setResult. */
final class FilterScreen extends Screen {

    private final AtlasData.Filter current;

    FilterScreen(@NonNull CarContext carContext, @NonNull AtlasData.Filter current) {
        super(carContext);
        this.current = current;
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        AtlasData.Filter[] filters = AtlasData.Filter.values();
        ItemList.Builder list = new ItemList.Builder();
        int selected = 0;
        for (int i = 0; i < filters.length; i++) {
            list.addItem(new Row.Builder().setTitle(filters[i].label).build());
            if (filters[i] == current) selected = i;
        }
        list.setSelectedIndex(selected);
        list.setOnSelectedListener(index -> {
            setResult(filters[index].id);
            getScreenManager().pop();
        });
        return new ListTemplate.Builder()
                .setSingleList(list.build())
                .setTitle("Show")
                .setHeaderAction(Action.BACK)
                .build();
    }
}
