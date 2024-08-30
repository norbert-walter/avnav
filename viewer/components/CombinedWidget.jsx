/*
###############################################################################
# Copyright (c) 2024, Andreas Vogel andreas@wellenvogel.net

#  Permission is hereby granted, free of charge, to any person obtaining a
#  copy of this software and associated documentation files (the "Software"),
#  to deal in the Software without restriction, including without limitation
#  the rights to use, copy, modify, merge, publish, distribute, sublicense,
#  and/or sell copies of the Software, and to permit persons to whom the
#  Software is furnished to do so, subject to the following conditions:
#
#  The above copyright notice and this permission notice shall be included
#  in all copies or substantial portions of the Software.
#
#  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
#  OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
#  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
#  THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
#  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
#  FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
#  DEALINGS IN THE SOFTWARE.
###############################################################################
*/
import {useKeyEventHandler} from "../util/GuiHelpers";
import {SortableProps, useAvNavSortable} from "../hoc/Sortable";
import {WidgetProps} from "./WidgetBase";
import PropTypes from "prop-types";
import React, {useState} from "react";
import theFactory from "./WidgetFactory";
import {EditableParameter} from "./EditableParameters";
import ItemList from "./ItemList";
import DialogButton from "./DialogButton";
import OverlayDialog, {useDialog} from "./OverlayDialog";
import EditWidgetDialog from "./EditWidgetDialog";

const ChildWidget=(props)=>{
    return <div className={'dialogRow row'}>
        <span className="inputLabel">{"sub"+props.index}</span>
        <div className="input" onClick={props.onClick}>{props.name}</div>
    </div>
}

const RenderChildParam=(props)=>{
    if (! props.currentValues) return null;
    const [Dialog,setDialog]=useDialog();
    const [children,setChildrenImpl]=useState(props.currentValues.children||[])
    const setChildren=(ch)=>{
        setChildrenImpl(ch);
        props.onChange({children:ch});
    }
    return <div className={'childWidgets'}>
        <Dialog/>
        <ItemList
            itemList={children}
            itemClass={ChildWidget}
            onItemClick={(item,data)=>{
                console.log("child widget click",item);
                setDialog((props)=>{
                    return <EditWidgetDialog
                        title={"Sub Widget "+item.index}
                        current={item}
                        weight={true}
                        closeCallback={()=>setDialog()}
                        updateCallback={(data)=>{
                            console.log("update",data);
                            if (data.index === undefined) return;
                            let next=[...children];
                            next[data.index]=data;
                            setChildren(next);
                        }}
                        removeCallback={(data)=> {
                            console.log("remove",data);
                            if (data.index === undefined) return;
                            let next=[...children];
                            next.splice(data.index,1);
                            setChildren(next);
                        }}
                    />
                })
            }}
        />
        <div className={'row dialogButtons insertButtons'}>
            <DialogButton
                name={'add'}
                onClick={()=>{
                    console.log("add widget click");
                    setDialog((props)=>{
                        return <EditWidgetDialog
                            title="Add Sub"
                            current={{}}
                            weight={true}
                            insertCallback={(data)=>{
                               console.log("add",data);
                               setChildren([...children,data]);
                            }}
                            closeCallback={()=>setDialog()}
                        />
                    })
                }}
            >
                +Sub</DialogButton>
        </div>
    </div>
}
class ChildrenParam extends EditableParameter {
    constructor() {
        super('children', -1);
    }
    render(props){
        return <RenderChildParam
            {...props}
            />
    }
}


export const CombinedWidget=(props)=>{
    useKeyEventHandler(props,"widget")
    let {editableParameters,children,onClick,childProperties,style,dragId,className,...forwardProps}=props;
    const ddProps = useAvNavSortable(dragId);
    const cl=(ev)=>{
        if (onClick) onClick(ev);
    }
    let cidx = 0;
    if (childProperties) delete childProperties.style;
    className = (className || '') + " widget combinedWidget";
    return <div  {...forwardProps}  {...ddProps} className={className} onClick={cl} style={{...style,...ddProps.style}}>
        {(children||[] ).map((item) => {
            let Item = theFactory.createWidget(item, childProperties);
            cidx++;
            return <Item key={cidx}/>
        })}
    </div>
}
CombinedWidget.propTypes={
    ...WidgetProps,
    ...SortableProps,
    children: PropTypes.array,
    childProperties: PropTypes.object,
    editableParameters: PropTypes.array
}
CombinedWidget.editableParameters={
    formatter: false,
    unit: false,
    formatterParameters: false,
    value: false,
    caption: false,
    children: new ChildrenParam()
}
